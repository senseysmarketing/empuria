import { useEffect } from "react";
import confetti from "canvas-confetti";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SaleSuccessOverlay({
  totalEurCents,
  onReset,
}: { totalEurCents: number; onReset: () => void }) {
  useEffect(() => {
    confetti({ particleCount: 120, spread: 90, origin: { y: 0.6 } });
    const t = setTimeout(onReset, 5000);
    return () => clearTimeout(t);
  }, [onReset]);

  return (
    <div className="fixed inset-0 z-50 bg-admin-bg/95 backdrop-blur flex items-center justify-center">
      <div className="text-center space-y-6 px-6">
        <CheckCircle2 className="h-20 w-20 mx-auto text-admin-accent" />
        <div className="space-y-2">
          <h2 className="font-display text-4xl text-admin-ink">Venda concluída</h2>
          <p className="font-display text-5xl font-bold text-admin-accent tabular-nums">€ {(totalEurCents / 100).toFixed(2)}</p>
        </div>
        <Button onClick={onReset} size="lg" className="bg-admin-accent text-white">Nova venda</Button>
      </div>
    </div>
  );
}
