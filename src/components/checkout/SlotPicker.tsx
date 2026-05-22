import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getSlotsForService } from "@/lib/checkout/checkout.functions";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export function SlotPicker({
  serviceId,
  value,
  onChange,
}: {
  serviceId: string;
  value?: string;
  onChange: (id: string) => void;
}) {
  const fetchSlots = useServerFn(getSlotsForService);
  const { data: slots = [], isLoading } = useQuery({
    queryKey: ["slots", serviceId],
    queryFn: () => fetchSlots({ data: { serviceId } }),
  });

  const grouped = slots.reduce<Record<string, typeof slots>>((acc, s) => {
    const day = new Date(s.starts_at).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
    (acc[day] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div>
      <Label>Escolha um horário</Label>
      {isLoading ? (
        <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-orange-brand" /></div>
      ) : slots.length === 0 ? (
        <p className="text-sm text-brown-deep/60 font-body py-3">
          Nenhuma vaga disponível no momento. Entre em contato pelo WhatsApp para liberar horário.
        </p>
      ) : (
        <div className="max-h-60 overflow-y-auto space-y-3 mt-2 pr-1">
          {Object.entries(grouped).map(([day, daySlots]) => (
            <div key={day}>
              <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50 mb-1">{day}</div>
              <div className="flex flex-wrap gap-2">
                {daySlots.map((s) => {
                  const time = new Date(s.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  const left = s.capacity - s.booked;
                  const selected = value === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChange(s.id)}
                      className={`px-3 py-2 rounded-md border text-sm font-display transition ${
                        selected
                          ? "bg-orange-brand text-offwhite border-orange-brand"
                          : "bg-offwhite border-border hover:border-orange-brand"
                      }`}
                    >
                      {time}
                      <span className="block text-[10px] opacity-70">{left} vaga{left !== 1 ? "s" : ""}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
