import type { Metadata } from "next";
import { ObsRoomDashboard } from "./ObsRoomDashboard";

export async function generateMetadata(
  props: { params: Promise<{ handle: string }> }
): Promise<Metadata> {
  const { handle } = await props.params;
  return {
    title: `Fontes de Transmissão · Sala ${handle}`,
    description: `Exportar transmissões da sala ${handle} para navegadores ou softwares de transmissão.`,
    robots: { index: false, follow: false },
  };
}

export default async function ObsDashboardPage(
  props: { params: Promise<{ handle: string }> }
) {
  const { handle } = await props.params;
  return <ObsRoomDashboard handle={handle} />;
}

