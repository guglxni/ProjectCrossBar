import { toast } from "sonner";
import { parseProgramError } from "./errors";
import { explorerTxLink } from "./format";

export async function sendAndToast(
  label: string,
  send: () => Promise<string>,
): Promise<string> {
  const id = toast.loading(`${label}...`);
  try {
    const sig = await send();
    toast.success(label, {
      id,
      action: {
        label: "Explorer",
        onClick: () => window.open(explorerTxLink(sig), "_blank", "noopener"),
      },
    });
    return sig;
  } catch (err) {
    toast.error(parseProgramError(err), { id });
    throw err;
  }
}
