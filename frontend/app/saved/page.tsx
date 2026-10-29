import { Suspense } from "react";
import { DocketView } from "@/components/DocketView";

export default function SavedPage() {
  return (
    <Suspense fallback={<div className="page" />}>
      <DocketView savedOnly />
    </Suspense>
  );
}
