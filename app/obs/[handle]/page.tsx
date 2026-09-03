import type { Metadata } from "next";
import { ObsRoomDashboard } from "./ObsRoomDashboard";

export async function generateMetadata(
  props: { params: Promise<{ handle: string }> }
): Promise<Metadata> {
  const { handle } = await props.params;
  return {
    title: `Fontes OBS · Sala ${handle}`,
    description: `Exportar transmissões da sala ${handle} para o OBS Studio.`,
    robots: { index: false, follow: false },
  };
}

export default async function ObsDashboardPage(
  props: { params: Promise<{ handle: string }> }
) {
  const { handle } = await props.params;
  return <ObsRoomDashboard handle={handle} />;
}

