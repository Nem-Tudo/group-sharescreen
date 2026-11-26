// Experiment "sq-offcard-cap": a connection that goes out past what the graphics card's
// encoder holds (CARD_STREAMS_MAX in lib/peerQualityController) is encoded in software, at
// most a core of the machine at 1080p, and goes out at 720p30 at most. Only means anything
// to those in sq-new-send.
//
// Why: on a machine with five or more viewers the extra connections go in VP8 in software,
// and the machine governor, which holds every connection to one level since they share a
// CPU, held 45-67% of those shares against 22% with four or fewer viewers
// (connection_quality_reports, 2026-11-17..25). The card's own connections cost the CPU next
// to nothing, so cutting everybody for the software ones is the wrong trade: this caps only
// the ones that cost it.
//
// Reports carry "sq-offcard-cap=on" in `experiments`, and `offCardShare` says how much of a
// session was off the card.

import { experimentFlag } from "./experimentFlag";

export const OFF_CARD_CAP_FEATURE = "sq-offcard-cap";

const flag = experimentFlag();
export const setOffCardCap = flag.set;
export const isOffCardCap = flag.get;
export const onOffCardCapChange = flag.onChange;
