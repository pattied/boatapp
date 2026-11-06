import { checkPasscode } from "@/lib/auth";
import { failure, json } from "@/lib/http";
import { createJob } from "@/lib/storage";

export async function POST(req: Request) {
  if (!checkPasscode(req)) return json({ error: "Wrong passcode." }, 401);
  try {
    const body = (await req.json().catch(() => ({}))) as { boatName?: unknown; customerName?: unknown };
    const boatName = typeof body.boatName === "string" ? body.boatName.trim().slice(0, 80) : "";
    const customerName =
      typeof body.customerName === "string" ? body.customerName.trim().slice(0, 60) : "";
    if (!boatName) return json({ error: "Enter the boat name." }, 400);
    const job = await createJob({ boatName, customerName });
    return json({ job }, 201);
  } catch (err) {
    return failure(err);
  }
}
