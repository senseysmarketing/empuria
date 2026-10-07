import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FinanceAccount } from "@/lib/admin/financeiro.functions";

export function FinanceAccountCombobox({
  accounts,
  currency,
  value,
  onChange,
  onCreate,
}: {
  accounts: FinanceAccount[];
  currency: string;
  value: string;
  onChange: (id: string) => void;
  onCreate: (name: string, currency: "BRL" | "EUR" | "USD") => Promise<string>;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const filtered = accounts.filter((account) => account.currency === currency);
  return (
    <div className="space-y-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={`Selecionar conta em ${currency}`} />
        </SelectTrigger>
        <SelectContent>
          {filtered.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ou digite uma nova conta"
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          disabled={creating || name.trim().length < 2}
          onClick={async () => {
            setCreating(true);
            try {
              const id = await onCreate(name.trim(), currency as "BRL" | "EUR" | "USD");
              onChange(id);
              setName("");
            } finally {
              setCreating(false);
            }
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
