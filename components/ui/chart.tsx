"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

/**
 * Minimal shadcn-style chart wrapper around recharts (installed but
 * unused until now -- Product Enhancements #1, "Analytics -- Visual
 * First"). Each series gets a CSS custom property (`--color-<key>`) set
 * on the container, so chart components reference `var(--color-<key>)`
 * instead of a hardcoded hex -- one place to change a series color, and
 * dark-mode swaps automatically if a config entry supplies different
 * light/dark values via `theme`.
 *
 * Deliberately smaller than shadcn's full chart.tsx (no chart-level
 * legend renderer yet) -- every chart shipped so far is single-series
 * (see dataviz skill: a single series needs no legend box, the card
 * title already says what's plotted). Extend with a legend component
 * when a multi-series chart (e.g. Phase 8's stock in vs out) needs one.
 */
export interface ChartConfig {
  [key: string]: {
    label: string
    color?: string
    theme?: { light: string; dark: string }
  }
}

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)
  if (!context) {
    throw new Error("Chart components must be used within a <ChartContainer>")
  }
  return context
}

function ChartContainer({
  config,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
}) {
  const colorVars = Object.entries(config).reduce<Record<string, string>>(
    (vars, [key, entry]) => {
      if (entry.color) {
        vars[`--color-${key}`] = entry.color
      } else if (entry.theme) {
        vars[`--color-${key}`] = entry.theme.light
        vars[`--color-${key}-dark`] = entry.theme.dark
      }
      return vars
    },
    {}
  )

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        className={cn(
          "aspect-auto h-[220px] w-full [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-axis-line]:stroke-border [&_.recharts-cartesian-grid_line]:stroke-dasharray-none",
          className
        )}
        style={{ ...colorVars, ...style } as React.CSSProperties}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

/**
 * Custom tooltip content matching the app's popover styling (bg-popover,
 * ring-1 ring-foreground/10, rounded-xl -- same language as Dialog/Sheet
 * content) rather than recharts' bare default tooltip box.
 */
function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: {
  active?: boolean
  payload?: readonly { name?: string; value?: number | string; dataKey?: string | number }[]
  label?: string | number
  formatter?: (value: number | string, name: string | number | undefined) => React.ReactNode
  labelFormatter?: (label: string | number) => React.ReactNode
}) {
  const { config } = useChart()

  if (!active || !payload || payload.length === 0) {
    return null
  }

  return (
    <div className="rounded-xl bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      {label != null && (
        <p className="mb-1 font-medium">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index)
          const entry = config[key]
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: `var(--color-${key})` }}
              />
              <span className="text-muted-foreground">{entry?.label ?? item.name}</span>
              <span className="ml-auto font-medium tabular-nums">
                {formatter && item.value != null ? formatter(item.value, item.dataKey) : item.value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ChartContainer, ChartTooltipContent, useChart }
