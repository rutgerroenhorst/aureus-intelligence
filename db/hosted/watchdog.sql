-- The watchdog: tells the user on Telegram when the site's own exit check has stopped.
--
-- HOSTED DATABASE ONLY (Supabase): it needs pg_net (to call Telegram) and Vault (where the bot token and the chat id are kept), which the laptop database does not have,
-- so this is not a migration. scripts/cron-setup.ts installs it (and the job that runs it every 5 minutes) when it is given the token and the chat in its environment;
-- scripts/cron-watchdog-test.ts checks it against a scratch database with stand-ins for pg_net and Vault.
--
-- Why it lives in the database and not on the site: the thing to watch is the site (or Vercel, or its secret, or its prices). A watchdog on the site would be silent exactly
-- when it is needed; the database's own clock (pg_cron) keeps running. If the database itself is down nothing can tell the user, and that is not solved here.
--
-- What it watches: the heartbeat the site's check leaves after every finished pass (exit_alert_kv 'hosted_tick_ok', written by apps/web/lib/exitTick.ts).
--   down   no finished pass for more than 10 minutes (the clock calls the site every 2): the site, Vercel, the secret or the database connection is broken
--   blind  passes finish, but for 15 minutes in a row not one held coin got a price (DexScreener not answering): alerts would be late
-- It speaks once when a problem starts, repeats after 6 hours if it is still there, and says when it is over. Its state is the row exit_alert_kv 'watchdog'.
-- The bot token and the chat id are read from Vault (aureus_telegram_token, aureus_telegram_chat) each time and never copied into a message, a log or a job's text.
--
-- aureus_watchdog(true, ...) sends a silent test message (no sound, marked as a test); the optional keys let a test use a heartbeat and a state row of its own
-- without touching the real ones.

create or replace function public.aureus_dur(minutes numeric)
returns text
language sql
immutable
as $$
  select case
    when minutes is null then 'onbekend'
    when minutes < 90 then round(minutes)::int::text || ' min'
    else replace(round(minutes / 60, 1)::text, '.', ',') || ' uur'
  end;
$$;

create or replace function public.aureus_watchdog(p_test boolean default false, p_hb_key text default 'hosted_tick_ok', p_state_key text default 'watchdog')
returns text
language plpgsql
as $$
declare
  c_stale_min  constant int := 10;
  c_blind_min  constant int := 15;
  c_repeat_h   constant int := 6;
  hb_at        timestamptz;
  hb_txt       text;
  hb           jsonb;
  age_min      numeric;
  cond         text;
  st_txt       text;
  st           jsonb;
  prev         text;
  since        timestamptz;
  told_at      timestamptz;
  msg          text;
  result       text := 'nothing to say';
  token        text;
  chat         text;
  tag          text := case when p_test then E'🧪 <b>Test</b>\n' else '' end;
  hhmm         text := 'HH24:MI';
begin
  select updated_at, value into hb_at, hb_txt from exit_alert_kv where key = p_hb_key;
  begin
    hb := hb_txt::jsonb;
  exception when others then
    hb := null;
  end;
  age_min := case when hb_at is null then null else extract(epoch from (now() - hb_at)) / 60 end;
  cond := case
    when hb_at is null or age_min > c_stale_min then 'down'
    when coalesce((hb->>'positions')::int, 0) > 0 and coalesce((hb->>'priced')::int, 0) = 0 then 'blind'
    else 'ok'
  end;

  select value into st_txt from exit_alert_kv where key = p_state_key;
  begin
    st := st_txt::jsonb;
  exception when others then
    st := null;
  end;
  prev := coalesce(st->>'state', 'ok');
  since := coalesce((st->>'since')::timestamptz, now());
  told_at := (st->>'told_at')::timestamptz;

  if cond = 'ok' then
    if prev <> 'ok' and told_at is not null then
      msg := tag || '✅ <b>Exit-controle loopt weer</b>' || E'\n' ||
             'Het was ' || case prev when 'blind' then 'zonder prijzen' else 'stil' end || ' van ' || to_char(since at time zone 'Europe/Amsterdam', hhmm) || ' tot ' || to_char(now() at time zone 'Europe/Amsterdam', hhmm) ||
             ' (' || public.aureus_dur(extract(epoch from (now() - since)) / 60) || E'). Coins die in die tijd 2× of 5× raakten en er nog boven staan, worden nu alsnog gemeld.';
      result := 'recovered';
    end if;
    since := now();
    told_at := null;
  else
    if prev <> cond then
      -- a new problem (or another kind of problem): the clock starts when the last good heartbeat was written (down) or now (blind)
      since := case when cond = 'down' then coalesce(hb_at, now()) else now() end;
      told_at := null;
    end if;
    if told_at is null and (cond = 'down' or now() - since >= make_interval(mins => c_blind_min)) then
      msg := tag || '⚠️ <b>' || case cond when 'down' then 'Exit-controle staat stil' else 'Exit-controle krijgt geen prijzen' end || '</b>' || E'\n' ||
             case cond
               when 'down' then
                 case when hb_at is null then 'De site heeft nog nooit een controle afgerond.' else 'De site heeft sinds <b>' || to_char(since at time zone 'Europe/Amsterdam', hhmm) || '</b> (' || public.aureus_dur(age_min) || ' geleden) geen controle meer afgerond.' end ||
                 ' Zolang dat zo is krijg je geen melding als een coin 2× of 5× je instap raakt.' || E'\n\n' || '<i>Kijk op de Telegram-pagina van de site, in Vercel (Logs, Deployments) en in Supabase.</i>'
               else
                 'De controle draait wel, maar sinds <b>' || to_char(since at time zone 'Europe/Amsterdam', hhmm) || '</b> komt er voor geen enkele coin die je bezit een prijs binnen (DexScreener?). Meldingen kunnen te laat komen.'
             end;
      result := 'told ' || cond;
    elsif told_at is not null and now() - told_at >= make_interval(hours => c_repeat_h) then
      msg := tag || '⏰ <b>Nog steeds: ' || case cond when 'down' then 'exit-controle staat stil' else 'exit-controle krijgt geen prijzen' end || '</b>' || E'\n' ||
             'Sinds ' || to_char(since at time zone 'Europe/Amsterdam', hhmm) || ' (' || public.aureus_dur(extract(epoch from (now() - since)) / 60) || ').';
      result := 'reminded ' || cond;
    end if;
  end if;

  if msg is not null then
    select decrypted_secret into token from vault.decrypted_secrets where name = 'aureus_telegram_token' limit 1;
    select decrypted_secret into chat from vault.decrypted_secrets where name = 'aureus_telegram_chat' limit 1;
    if token is null or chat is null then
      -- nobody to tell: leave the state as it was, so that the next run tries again once the secrets are there
      return 'cannot tell: no telegram secrets in the vault';
    end if;
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || token || '/sendMessage',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('chat_id', chat, 'text', msg, 'parse_mode', 'HTML', 'disable_web_page_preview', true, 'disable_notification', p_test),
      timeout_milliseconds := 15000
    );
    if result like 'told%' or result like 'reminded%' then told_at := now(); end if;
  end if;

  insert into exit_alert_kv (key, value)
  values (p_state_key, jsonb_build_object('state', case when cond = 'ok' then 'ok' else cond end, 'since', since, 'told_at', told_at)::text)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return result;
end;
$$;

revoke all on function public.aureus_dur(numeric) from public;
revoke all on function public.aureus_watchdog(boolean, text, text) from public;
