"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { SelectField } from "@/components/ui/form/SelectField";
import { CoworkerDataAccess } from "./CoworkerDataAccess";

export function CoworkerDataAccessSettings({ coworkers, allowed }: {
  coworkers: Array<{ agentId: string; name: string; levels: string[]; editable: boolean }>;
  allowed: string[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(coworkers[0]?.agentId ?? "");
  const coworker = coworkers.find((item) => item.agentId === selected);
  return (
    <div>
      <Button variant="secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>Data access</Button>
      {open ? (
        <Surface as="section" id={id} aria-label="Coworker data access" className="mt-3">
          <SelectField name={`${id}-coworker`} label="Coworker" value={selected} onValueChange={setSelected}
            options={coworkers.map((item) => ({ value: item.agentId,
              label: coworkers.filter((other) => other.name === item.name).length > 1 ? `${item.name} (${item.agentId})` : item.name }))} />
          {coworker ? <CoworkerDataAccess key={coworker.agentId} agentId={coworker.agentId} current={coworker.levels}
            allowed={coworker.editable ? allowed : []} /> : <p>No coworkers are available.</p>}
        </Surface>
      ) : null}
    </div>
  );
}
