"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Spinner, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const Schema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(60, "At most 60 characters"),
  defaultRegime: z.enum(["cheap", "balanced", "expensive"]),
  requireSeparateApprover: z.boolean(),
});
type Form = z.infer<typeof Schema>;

export function WorkspaceForm({ initial, canEdit }: { initial: Form; canEdit: boolean }) {
  const act = useAction();
  const { register, control, handleSubmit, formState, reset } = useForm<Form>({ resolver: zodResolver(Schema), defaultValues: initial });

  return (
    <form
      className="max-w-xl space-y-6"
      onSubmit={handleSubmit(async (f) => {
        const r = await act.run("/api/workspace", f, { method: "PATCH", success: () => "Workspace saved", failure: "Could not save" });
        if (r) reset(f);
      })}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ws-name" className="text-[13px]">
          Name
        </Label>
        <Input id="ws-name" disabled={!canEdit} {...register("name")} aria-invalid={!!formState.errors.name} />
        {formState.errors.name && <p className="text-[12px] text-bad">{formState.errors.name.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ws-regime" className="text-[13px]">
          Default cost regime for new streams
        </Label>
        <Controller
          control={control}
          name="defaultRegime"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
              <SelectTrigger id="ws-regime" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cheap">Cheap</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="expensive">Expensive</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-[12px] text-muted-foreground">Simulated price level used by the demo stream and onboarding.</p>
      </div>
      <div className="flex items-start justify-between gap-6 border-y border-border py-4">
        <div>
          <Label htmlFor="ws-separate" className="text-[13.5px]">
            Require a separate approver
          </Label>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">Updates and promotions must be requested by one person and approved by another. Nobody can approve their own request or promote a model they trained.</p>
        </div>
        <Controller control={control} name="requireSeparateApprover" render={({ field }) => <Switch id="ws-separate" checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />} />
      </div>
      {canEdit ? (
        <Button type="submit" disabled={!formState.isDirty || act.pending}>
          {act.pending && <Spinner />}
          Save changes
        </Button>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">Only admins can change workspace settings.</p>
      )}
    </form>
  );
}
