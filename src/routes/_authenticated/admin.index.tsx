import { createFileRoute } from "@tanstack/react-router";
import { ArrivalDialog } from "@/components/admin/ArrivalDialog";
import { PassportScannerDialog } from "@/components/admin/PassportScannerDialog";
import { CockpitStaffView } from "@/components/admin/cockpit/CockpitStaffView";
import { useTopBarActions } from "@/components/shared/TopBarActionsContext";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: CockpitPage,
});

function CockpitPage() {
  useTopBarActions(
    <>
      <PassportScannerDialog />
      <ArrivalDialog />
    </>,
  );

  return <CockpitStaffView />;
}
