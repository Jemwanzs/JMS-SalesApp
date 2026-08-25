"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UOM_CATEGORIES } from "@/lib/inventory/units-of-measure";

const CUSTOM_VALUE = "__custom__";

/**
 * Grouped unit picker (Product Enhancements #5) with a "Custom…" escape
 * hatch -- reveals a free-text input when picked, so a tenant is never
 * restricted to the fixed list. `value`/`isCustom` mirror
 * products.unit_of_measure/unit_of_measure_is_custom directly.
 */
export function UnitOfMeasureSelect({
  value,
  isCustom,
  onChange,
}: {
  value: string | null;
  isCustom: boolean;
  onChange: (value: string | null, isCustom: boolean) => void;
}) {
  const [customText, setCustomText] = useState(isCustom ? (value ?? "") : "");

  return (
    <div className="space-y-2">
      <Label>Unit of measure</Label>
      <Select
        value={isCustom ? CUSTOM_VALUE : (value ?? undefined)}
        onValueChange={(next) => {
          if (next === CUSTOM_VALUE) {
            onChange(customText || null, true);
          } else {
            onChange(next, false);
          }
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select a unit" />
        </SelectTrigger>
        <SelectContent>
          {UOM_CATEGORIES.map((cat) => (
            <SelectGroup key={cat.category}>
              <SelectLabel>{cat.category}</SelectLabel>
              {cat.units.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectGroup>
            <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      {isCustom && (
        <Input
          value={customText}
          onChange={(e) => {
            setCustomText(e.target.value);
            onChange(e.target.value || null, true);
          }}
          placeholder="e.g. drums, bales, spools"
        />
      )}
    </div>
  );
}
