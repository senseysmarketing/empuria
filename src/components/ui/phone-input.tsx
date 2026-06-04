import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  type SupportedCountry,
  dialCodeFor,
  formatAsYouType,
  getCountryFromPhone,
  getCountryOption,
  normalizePhone,
  splitE164,
} from "@/lib/phone/phone.utils";

export interface PhoneInputProps {
  /** E.164 (ex.: +5511999999999). Componente é controlado por este valor. */
  value: string | null | undefined;
  onChange: (e164: string | null, meta: { country: SupportedCountry; raw: string }) => void;
  defaultCountry?: SupportedCountry;
  /** ISO já salvo no banco (profiles.phone_country_iso etc.) — preferido sobre defaultCountry. */
  country?: SupportedCountry | null;
  onCountryChange?: (country: SupportedCountry) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  id?: string;
  required?: boolean;
  invalid?: boolean;
  /** "light" usa fundo branco (default), "admin" usa bg-admin-bg + border-admin-border */
  variant?: "light" | "admin";
}

export function PhoneInput({
  value,
  onChange,
  defaultCountry = DEFAULT_COUNTRY,
  country: countryProp,
  onCountryChange,
  placeholder,
  disabled,
  className,
  inputClassName,
  id,
  required,
  invalid,
  variant = "light",
}: PhoneInputProps) {
  // Estado interno: país escolhido + número nacional sendo digitado.
  const initial = useMemo(() => {
    if (countryProp) {
      const s = value ? splitE164(value) : { country: countryProp, national: "" };
      return {
        country: countryProp,
        national: s.national || "",
      };
    }
    if (value) return splitE164(value);
    return { country: defaultCountry, national: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [country, setCountry] = useState<SupportedCountry>(initial.country);
  const [national, setNational] = useState<string>(
    initial.national ? formatAsYouType(initial.national, initial.country) : "",
  );
  const [open, setOpen] = useState(false);
  const lastEmit = useRef<string | null>(null);

  // Sincroniza se o pai trocar `value` externamente (ex.: reset).
  useEffect(() => {
    if (value && value !== lastEmit.current) {
      const s = splitE164(value);
      setCountry(s.country);
      setNational(formatAsYouType(s.national, s.country));
    } else if (!value && lastEmit.current) {
      setNational("");
    }
  }, [value]);

  const emit = (nextCountry: SupportedCountry, nextNational: string) => {
    const e164 = normalizePhone(nextNational, nextCountry);
    lastEmit.current = e164;
    onChange(e164, { country: nextCountry, raw: nextNational });
  };

  const handleCountrySelect = (next: SupportedCountry) => {
    setCountry(next);
    setOpen(false);
    onCountryChange?.(next);
    const reformatted = formatAsYouType(national.replace(/\D/g, ""), next);
    setNational(reformatted);
    emit(next, reformatted);
  };

  const handleInputChange = (raw: string) => {
    const formatted = formatAsYouType(raw, country);
    setNational(formatted);
    emit(country, formatted);
  };

  const opt = getCountryOption(country);
  const ddi = dialCodeFor(country);

  const isAdmin = variant === "admin";
  const wrapperBg = isAdmin ? "bg-admin-bg border-admin-border" : "bg-white border-input";
  const dividerColor = isAdmin ? "bg-admin-border" : "bg-input";

  return (
    <div
      className={cn(
        "flex h-10 items-stretch rounded-md border overflow-hidden",
        wrapperBg,
        invalid && "border-destructive",
        disabled && "opacity-60 pointer-events-none",
        className,
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-full rounded-none px-2.5 gap-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
            aria-label="Selecionar país"
          >
            <span className="text-base leading-none">{opt.flag}</span>
            <span className="text-xs font-medium tabular-nums text-foreground">{ddi || "+"}</span>
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[260px]" align="start">
          <Command>
            <CommandInput placeholder="Buscar país…" className="h-9" />
            <CommandList>
              <CommandEmpty>Nenhum país.</CommandEmpty>
              <CommandGroup>
                {COUNTRY_OPTIONS.map((c) => (
                  <CommandItem
                    key={c.iso}
                    value={`${c.name} ${c.dialCode} ${c.iso}`}
                    onSelect={() => handleCountrySelect(c.iso)}
                    className="gap-2"
                  >
                    <span className="text-base">{c.flag}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {c.dialCode || "—"}
                    </span>
                    {c.iso === country && <Check className="h-3.5 w-3.5 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className={cn("w-px", dividerColor)} aria-hidden />

      <div className="relative flex-1">
        <Phone className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" />
        <Input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required={required}
          disabled={disabled}
          value={national}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder ?? "(11) 99999-9999"}
          className={cn(
            "h-full border-0 rounded-none pl-8 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
            inputClassName,
          )}
        />
      </div>
    </div>
  );
}

export { getCountryFromPhone };
