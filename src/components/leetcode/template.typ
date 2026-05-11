#import "@preview/cmarker:0.1.8"
#import "@preview/mitex:0.2.7"

#let font = (
  serif: ("STIX Two Text", "Source Han Serif SC"),
  sans: ("Source Han Sans SC",),
  mono: ("Fira Code", "Source Han Sans SC"),
  math: ("STIX Two Math", "STIX Two Text", "Source Han Serif SC"),
  // ...auto
)

#let tint = (
  light: rgb("#faf5ff").lighten(50%),
  _50: rgb("#faf5ff"),
  _100: rgb("#f3e8ff"),
  _200: rgb("#e9d5ff"),
  _300: rgb("#d8b4fe"),
  _400: rgb("#c084fc"),
  _500: rgb("#a855f7"),
  _600: rgb("#9333ea"),
  _700: rgb("#7e22ce"),
  _800: rgb("#6b21a8"),
  _900: rgb("#581c87"),
  _950: rgb("#3b0764"),
  dark: rgb("#3b0764").darken(50%),
)

#let border-stroke = (paint: tint._800, thickness: .5pt)

#let pre-block(body) = {
  let margin = .75pt

  set text(font: font.mono, size: .9em)
  block(
    stroke: (left: (paint: tint._700, thickness: 2pt + 2 * margin)),
    inset: (left: margin, y: 2 * margin),
    block(
      width: 100%,
      fill: tint.light,
      radius: (right: .5em),
      stroke: (left: (paint: tint.light, thickness: 1pt + margin)),
      inset: .75em,
      text(fill: tint._800.mix(luma(128)))[

        #body
      ],
    ),
  )
}

#set text(font: font.serif)
#show strong: set text(fill: tint._800)

#set page(width: 18cm, height: auto, margin: (x: 1cm, y: 1.5cm))

#show heading: align.with(center)
#show heading: set text(font: font.sans, fill: tint._800)
#show heading: set block(below: 1em)

#show raw: set text(font: font.mono, size: 1em / .9)
#show raw.where(block: false): box.with(
  fill: luma(240),
  inset: (x: .25em),
  outset: (y: .25em),
  radius: .25em,
)

#show table: figure
#show table.cell: it => {
  if it.y == 0 {
    strong(it)
  } else {
    it
  }
}
#set table(
  fill: (x, y) => if y == 0 { tint.light },
  inset: (x: 1.5em, y: .5em),
  stroke: (x, y) => (y: border-stroke) + if x != 0 { (left: border-stroke) },
)

#let input-file = sys.inputs.at("input", default: "./example.md")
#cmarker.render(
  math: mitex.mitex,
  read(input-file),
  blockquote: pre-block,
)
