"use client";

import { defineComponent } from "@openuidev/react-lang";
import { PieChart } from "@openuidev/react-ui";
import { z } from "zod";

const palette = ["#2563eb", "#d97706", "#0f766e", "#be185d", "#7c3aed", "#b91c1c", "#4d7c0f", "#475569"];

export const ColorPieChart = defineComponent({
  name: "PieChart",
  description: "Native pie or donut chart with distinct slice colors. Supply literal labels and numeric values of equal length.",
  props: z.object({
    labels: z.array(z.string()),
    values: z.array(z.number()),
    variant: z.enum(["pie", "donut"]).optional(),
    appearance: z.enum(["circular", "semiCircular"]).optional(),
  }),
  component: ({ props }) => {
    if (!props.labels.length || props.labels.length !== props.values.length) return null;
    return <PieChart
      data={props.labels.map((category, index) => ({ category, value: props.values[index] }))}
      categoryKey="category"
      dataKey="value"
      customPalette={palette}
      variant={props.variant}
      appearance={props.appearance}
      isAnimationActive={false}
    />;
  },
});
