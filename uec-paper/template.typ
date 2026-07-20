// uec-paper/template.typ — document template for the UEC paper.
//
// Typst template-function pattern (https://typst.app/docs/reference/):
// the entry file applies it as a show rule:
//
//   #import "uec-paper/template.typ": uec-paper
//   #show: uec-paper.with(title: [...], abstract: [...], ...)
//
// Everything after the show rule becomes `body`.

#let uec-paper(
  title: [],
  subtitle: none,
  abstract: none,
  keywords: none,
  body,
) = {
  // ── Page & text defaults ─────────────────────────────────────────────
  set page(paper: "a4", margin: 2cm, numbering: "1")
  set text(size: 10pt)
  set par(justify: true)
  set heading(numbering: none)
  set math.equation(numbering: "(1)")

  // ── Show rules ───────────────────────────────────────────────────────
  show raw.where(block: true): it => block(
    fill: luma(245), inset: 8pt, radius: 3pt, width: 100%,
    text(size: 7.5pt, it),
  )
  show link: it => underline(text(fill: blue.darken(20%), it))

  // ── Title block ──────────────────────────────────────────────────────
  align(center)[
    #text(size: 16pt, weight: "bold")[#title]
    #if subtitle != none [
      #v(0.3em)
      #text(size: 10pt)[#subtitle]
    ]
  ]

  // ── Abstract & keywords ──────────────────────────────────────────────
  if abstract != none {
    block(inset: (left: 2em, right: 2em), above: 1em, below: 1em)[
      #text(size: 9.5pt)[
        *Abstract* — #abstract
        #if keywords != none [
          #v(0.4em)
          *Keywords* — #keywords
        ]
      ]
    ]
  }

  line(length: 100%, stroke: 0.5pt)

  body
}
