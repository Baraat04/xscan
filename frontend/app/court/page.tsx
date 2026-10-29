import { Suspense } from "react";
import { Courtroom } from "@/components/Courtroom";

export default function CourtPage() {
  return (
    <Suspense fallback={<div className="page court-page" />}>
      <Courtroom />
    </Suspense>
  );
}
