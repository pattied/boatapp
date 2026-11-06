import { q } from "@/lib/db";
import { json, failure } from "@/lib/http";

// Names for the technician sign-in picker. Names only, no contact details.
export async function GET() {
  try {
    const techs = await q<{ id: string; name: string; crew: string | null }>(
      `select t.id, t.name, c.name as crew from technicians t left join crews c on c.id = t.crew_id
       where t.active order by t.name`,
    );
    return json({ techs });
  } catch (err) {
    return failure(err);
  }
}
