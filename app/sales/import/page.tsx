import { runImport } from "../actions";
import ImportWizard from "@/components/sales/ImportWizard";
import { IMPORT_FIELDS } from "@/lib/import";
import { requireSales } from "@/lib/session";

export default async function ImportLeads() {
  await requireSales();
  return (
    <>
      <header className="top">
        <h1>Import a list</h1>
        <p className="muted small">Load many leads at once from a spreadsheet: a boat show list, a marina tenant list, a list of referrals.</p>
      </header>
      <ImportWizard fields={IMPORT_FIELDS} action={runImport} />
    </>
  );
}
