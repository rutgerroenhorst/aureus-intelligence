import { Suspense } from "react";
import type { Metadata } from "next";
import KennisClient from "./KennisClient";

export const metadata: Metadata = { title: "Kennis · Auriga" };

export default function KennisPage() {
  return (
    <Suspense fallback={null}>
      <KennisClient />
    </Suspense>
  );
}
