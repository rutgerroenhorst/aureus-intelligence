import { internalFetch } from "@/lib/internalFetch";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Max 60 seconds

// Unified learning worker orchestrates all learning tasks
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const task = searchParams.get("task") || "full";

    const results: any = {
      timestamp: new Date().toISOString(),
      tasks_completed: [],
    };

    // Update pending coin outcomes (run frequently - every 5 minutes)
    if (task === "full" || task === "update-outcomes") {
      try {
        const outcomeRes = await internalFetch(`/api/learning-update-outcomes`,
          { method: "POST" }
        );
        const outcomeData = await outcomeRes.json();
        results.tasks_completed.push({
          task: "update-outcomes",
          success: outcomeRes.ok,
          updated_count: outcomeData.updated_count,
          pending_coins: outcomeData.total_pending,
        });
      } catch (err) {
        console.error("[learning-worker] Update outcomes failed:", err);
        results.tasks_completed.push({
          task: "update-outcomes",
          success: false,
          error: String(err),
        });
      }
    }

    // Generate filter suggestions (run less frequently - every hour)
    if (task === "full" || task === "generate-suggestions") {
      try {
        const suggestionsRes = await internalFetch(`/api/learning-generate-suggestions`,
          { method: "POST" }
        );
        const suggestionsData = await suggestionsRes.json();
        results.tasks_completed.push({
          task: "generate-suggestions",
          success: suggestionsRes.ok,
          generated_count: suggestionsData.generated_count,
          top_suggestions: suggestionsData.suggestions.slice(0, 3),
        });
      } catch (err) {
        console.error("[learning-worker] Generate suggestions failed:", err);
        results.tasks_completed.push({
          task: "generate-suggestions",
          success: false,
          error: String(err),
        });
      }
    }

    return NextResponse.json(results);
  } catch (err) {
    console.error("[learning-worker] Error:", err);
    return NextResponse.json(
      {
        error: "Learning worker failed",
        details: String(err),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  // Health check endpoint
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "status";

    if (action === "status") {
      return NextResponse.json({
        status: "learning_system_online",
        version: "1.0.0",
        available_tasks: ["update-outcomes", "generate-suggestions", "full"],
        usage: "POST /api/learning-worker?task=full|update-outcomes|generate-suggestions",
      });
    }

    if (action === "trigger-full") {
      // Manually trigger full learning cycle
      return NextResponse.json({
        message: "Use POST request to trigger learning tasks",
        endpoint: "/api/learning-worker?task=full",
      });
    }

    return NextResponse.json({
      message: "Learning worker API",
      endpoints: {
        update_outcomes: "POST /api/learning-worker?task=update-outcomes",
        generate_suggestions: "POST /api/learning-worker?task=generate-suggestions",
        full_cycle: "POST /api/learning-worker?task=full",
        status: "GET /api/learning-worker?action=status",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}
