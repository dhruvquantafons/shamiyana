import { requireAnyPermission } from "../../../lib/auth";
import { PageHeader } from "../../components/ui";
import RatesTabs from "./RatesTabs";

export default async function RatesLayout({ children }: { children: React.ReactNode }) {
  await requireAnyPermission(["rates.view", "rates.manage"]);
  return (
    <>
      <PageHeader
        title="Rates & inventory"
        description="Room types, rate plans, seasonal pricing, stay restrictions and channel allocation. Changes apply to new quotes immediately."
      />
      <RatesTabs />
      {children}
    </>
  );
}
