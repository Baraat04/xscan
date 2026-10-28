import { Suspense } from "react";
import { DocketView } from "@/components/DocketView";

export default function DocketPage() {
  return (
    <Suspense fallback={<div className="page" />}>
      <DocketView />
    </Suspense>
  );
}
