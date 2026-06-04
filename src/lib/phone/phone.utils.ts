import {
  parsePhoneNumberFromString,
  AsYouType,
  getCountryCallingCode,
  type CountryCode,
} from "libphonenumber-js";

export type SupportedCountry =
  | "BR"
  | "ES"
  | "PT"
  | "IT"
  | "FR"
  | "DE"
  | "GB"
  | "US"
  | "OTHER";

export interface CountryOption {
  iso: SupportedCountry;
  name: string;
  flag: string;
  dialCode: string;
  /** ISO usado pela lib libphonenumber-js (OTHER cai para fallback) */
  libCode?: CountryCode;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { iso: "BR", name: "Brasil", flag: "🇧🇷", dialCode: "+55", libCode: "BR" },
  { iso: "ES", name: "Espanha", flag: "🇪🇸", dialCode: "+34", libCode: "ES" },
  { iso: "PT", name: "Portugal", flag: "🇵🇹", dialCode: "+351", libCode: "PT" },
  { iso: "IT", name: "Itália", flag: "🇮🇹", dialCode: "+39", libCode: "IT" },
  { iso: "FR", name: "França", flag: "🇫🇷", dialCode: "+33", libCode: "FR" },
  { iso: "DE", name: "Alemanha", flag: "🇩🇪", dialCode: "+49", libCode: "DE" },
  { iso: "GB", name: "Reino Unido", flag: "🇬🇧", dialCode: "+44", libCode: "GB" },
  { iso: "US", name: "Estados Unidos", flag: "🇺🇸", dialCode: "+1", libCode: "US" },
  { iso: "OTHER", name: "Outro", flag: "🌐", dialCode: "" },
];

export const DEFAULT_COUNTRY: SupportedCountry = "BR";

export function getCountryOption(iso: SupportedCountry | string | null | undefined): CountryOption {
  return (
    COUNTRY_OPTIONS.find((c) => c.iso === iso) ??
    COUNTRY_OPTIONS.find((c) => c.iso === DEFAULT_COUNTRY)!
  );
}

/**
 * Normaliza um input livre em E.164. Aceita números com DDI, sem DDI, com máscara,
 * com 00 internacional ou apenas dígitos. Quando `country` é informado e o input
 * não tem DDI, assume aquele país.
 */
export function normalizePhone(
  input: string | null | undefined,
  country?: SupportedCountry | null,
): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Converte 00XX... em +XX...
  const withPlus = raw.startsWith("00") ? "+" + raw.slice(2).replace(/\D/g, "") : raw;
  const libCountry =
    country && country !== "OTHER" ? (country as CountryCode) : undefined;

  try {
    const parsed = parsePhoneNumberFromString(withPlus, libCountry);
    if (parsed && parsed.isValid()) {
      return parsed.number; // E.164 com '+'
    }
    // tentativa sem país (input já em internacional)
    if (!libCountry) {
      const alt = parsePhoneNumberFromString(withPlus.startsWith("+") ? withPlus : `+${withPlus.replace(/\D/g, "")}`);
      if (alt && alt.isValid()) return alt.number;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Formata um E.164 para exibição amigável. Se inválido, devolve o input cru. */
export function formatPhoneForDisplay(e164: string | null | undefined): string {
  if (!e164) return "";
  try {
    const parsed = parsePhoneNumberFromString(String(e164));
    if (parsed) return parsed.formatInternational();
  } catch {
    // ignore
  }
  return String(e164);
}

/** Detecta o país (ISO) a partir de um E.164. Default: BR. */
export function getCountryFromPhone(
  e164: string | null | undefined,
): SupportedCountry {
  if (!e164) return DEFAULT_COUNTRY;
  try {
    const parsed = parsePhoneNumberFromString(String(e164));
    if (parsed?.country) {
      const found = COUNTRY_OPTIONS.find((c) => c.iso === parsed.country);
      if (found) return found.iso;
      return "OTHER";
    }
  } catch {
    // ignore
  }
  return DEFAULT_COUNTRY;
}

/** Converte E.164 em JID para Uazapi/WhatsApp (apenas dígitos, sem '+'). */
export function phoneToWhatsAppJid(e164: string | null | undefined): string | null {
  const norm = normalizePhone(e164);
  if (!norm) {
    // tenta extrair dígitos puros
    const digits = String(e164 ?? "").replace(/\D/g, "");
    return digits.length >= 8 ? digits : null;
  }
  return norm.replace(/\D/g, "");
}

/** Valida E.164. */
export function isValidPhone(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = parsePhoneNumberFromString(String(value));
    return Boolean(parsed?.isValid());
  } catch {
    return false;
  }
}

/** Formata enquanto o usuário digita, considerando o país selecionado. */
export function formatAsYouType(
  national: string,
  country: SupportedCountry,
): string {
  if (country === "OTHER") return national;
  try {
    return new AsYouType(country as CountryCode).input(national);
  } catch {
    return national;
  }
}

/** Devolve o DDI textual ('+55') do país. */
export function dialCodeFor(country: SupportedCountry): string {
  const opt = getCountryOption(country);
  if (opt.dialCode) return opt.dialCode;
  if (country !== "OTHER") {
    try {
      return "+" + getCountryCallingCode(country as CountryCode);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * A partir de um E.164 e país, devolve apenas o número nacional para exibir
 * dentro do PhoneInput.
 */
export function splitE164(e164: string | null | undefined): {
  country: SupportedCountry;
  national: string;
} {
  if (!e164) return { country: DEFAULT_COUNTRY, national: "" };
  try {
    const parsed = parsePhoneNumberFromString(String(e164));
    if (parsed) {
      const iso = (COUNTRY_OPTIONS.find((c) => c.iso === parsed.country)?.iso ??
        "OTHER") as SupportedCountry;
      return { country: iso, national: parsed.nationalNumber.toString() };
    }
  } catch {
    // ignore
  }
  return { country: DEFAULT_COUNTRY, national: String(e164) };
}
