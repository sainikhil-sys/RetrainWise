import { route } from "@/lib/api";
import { getAllModels } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => ({ models: await getAllModels(ctx.workspace.id) }));
