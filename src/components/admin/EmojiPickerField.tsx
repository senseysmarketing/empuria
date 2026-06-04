import { lazy, Suspense, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

const EmojiPicker = lazy(() => import("emoji-picker-react"));

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export function EmojiPickerField({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-10 w-12 rounded-md border border-admin-border bg-admin-bg flex items-center justify-center text-xl hover:bg-admin-bg/70 transition"
            aria-label="Selecionar emoji"
          >
            {value || <span className="opacity-40 text-base">😊</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0 border-none w-auto" align="start">
          <Suspense fallback={<div className="p-4 text-xs text-admin-ink-muted">Carregando…</div>}>
            <EmojiPicker
              onEmojiClick={(e) => {
                onChange(e.emoji);
                setOpen(false);
              }}
              width={320}
              height={380}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onChange("")}
          aria-label="Limpar emoji"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
