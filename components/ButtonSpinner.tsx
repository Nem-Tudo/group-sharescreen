// The "this is happening" mark for a button that has been pressed.
//
// Every action button in the app used to fall into one of two states on
// click: some swapped their label ("Criando..."), and the ones that navigate
// — entering a room, opening a recent room — did nothing at all until the
// next page painted. On a slow connection that is a button that looks
// ignored, and the reliable human response to a button that looks ignored is
// to press it again.
//
// Deliberately tiny and inline rather than an overlay or a full-button
// replacement: the label has to stay readable, because "what did I just
// click" is exactly the question a spinner is answering.
//
// `currentColor` so it inherits whatever the button is already painting its
// text with — this sits inside a dark button, a light one and a bordered one,
// and a fixed colour would be wrong in two of the three.
export function ButtonSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      // Not aria-hidden: on a button whose label does not change, this is the
      // only thing announcing that anything happened. The label beside it
      // says what; this says that it is under way.
      role="status"
      aria-label="Carregando"
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
