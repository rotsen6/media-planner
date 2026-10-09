import Workspace from "@/components/workspace";
import { loadExampleBriefs } from "@/lib/planning/dataset";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Without examples the workspace still works and shows setup instructions.
  return <Workspace examples={await loadExampleBriefs().catch(() => [])} />;
}
