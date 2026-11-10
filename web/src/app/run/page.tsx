import { Suspense } from "react";
import { RunView } from "./run-view";

export default function RunPage() {
  return (
    <Suspense>
      <RunView />
    </Suspense>
  );
}
