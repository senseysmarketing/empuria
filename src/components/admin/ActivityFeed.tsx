import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ShoppingBag,
  CheckCircle2,
  UserPlus,
  Crown,
  CalendarPlus,
  DoorOpen,
  Sparkles,
  MessageSquarePlus,
  type LucideIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ActivityRow = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  created_at: string;
};

const iconMap: Record<string, LucideIcon> = {
  order_created: ShoppingBag,
  order_paid: CheckCircle2,
  lead_created: UserPlus,
  lead_qualified: Sparkles,
  lead_dismissed: UserPlus,
  member_joined: Crown,
  appointment_created: CalendarPlus,
  arrival_registered: DoorOpen,
  content_published: Sparkles,
  post_created: MessageSquarePlus,
};

export function ActivityFeed({ initial }: { initial: ActivityRow[] }) {
  const [items, setItems] = useState<ActivityRow[]>(initial);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    const channel = supabase
      .channel("activity_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "activity_feed" },
        (payload) => {
          setItems((prev) => [payload.new as ActivityRow, ...prev].slice(0, 50));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (items.length === 0) {
    return <p className="text-sm text-admin-ink-muted">Sem atividade ainda. Assim que houver vendas, leads ou check-ins, eles aparecem aqui em tempo real.</p>;
  }

  return (
    <ul className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
      {items.map((it) => {
        const Icon = iconMap[it.type] ?? Sparkles;
        return (
          <li key={it.id} className="flex gap-3 items-start">
            <div className="h-8 w-8 rounded-full bg-admin-accent-soft flex items-center justify-center shrink-0">
              <Icon className="h-4 w-4 text-admin-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-admin-ink truncate">{it.title}</div>
              {it.description && <div className="text-xs text-admin-ink-muted truncate">{it.description}</div>}
              <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted/70 mt-0.5">
                {formatDistanceToNow(new Date(it.created_at), { locale: ptBR, addSuffix: true })}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
