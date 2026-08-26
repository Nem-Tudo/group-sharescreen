import type { Metadata } from "next";
import { RoomsMapClient } from "./RoomsMapClient";

export const metadata: Metadata = {
  title: "Mapa de salas públicas",
  description:
    "Veja no mapa do mundo onde estão as salas públicas de transmissão de tela ativas agora no GoLive e entre na que estiver mais perto de você.",
  alternates: {
    canonical: "/worldmap",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RoomsMapPage() {
  return <RoomsMapClient />;
}
