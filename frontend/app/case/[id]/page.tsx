"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CaseView } from "@/components/CaseView";

function Case() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  return <CaseView id={id} autoCall={params.get("call") === "1"} />;
}

export default function CasePage() {
  return (
    <Suspense fallback={<div className="page case-page" />}>
      <Case />
    </Suspense>
  );
}
