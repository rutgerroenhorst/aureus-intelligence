import { getBoardView } from "../../lib/boardSections";
import { BoardLive } from "./BoardLive";

export const dynamic = "force-dynamic";

export default async function ActionBoardPage() {
  const initial = await getBoardView();
  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Action Board</h1>
          <p className="page-sub">
            Two decisions, kept separate: <b>is this a good coin to follow</b>, and <b>when is the entry</b>.
            Missing on-chain data is shown as UNKNOWN RISK — never as a pass.
          </p>
        </div>
      </header>
      <BoardLive initial={initial} />
    </>
  );
}
