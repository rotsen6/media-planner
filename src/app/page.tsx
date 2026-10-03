import { loadExampleBriefs } from "@/lib/data";
import Workspace from "@/components/workspace";

export const dynamic = "force-dynamic";
export default async function Page() {
  let examples: string[] = [];
  try {
    examples = await loadExampleBriefs();
  } catch {
    /* Setup instructions are shown in the workspace. */
  }
  return <Workspace examples={examples} />;
}
