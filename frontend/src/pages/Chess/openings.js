// Curated opening repertoire for the teaching-focused "Openings" tab.
//
// `moves` is the sequence of SAN moves (White and Black alternate) that
// reaches the tabiya shown on the replay board. Keep these short and
// unambiguous — chess.js resolves each SAN against the current position, so
// they replay reliably one after another.

export const OPENINGS = [
  {
    id: 'italian',
    name: 'Italian Game',
    eco: 'C50',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'],
    description:
      'One of the oldest recorded openings. White develops the bishop to c4, eyeing the f7 pawn — Black\u2019s weakest point — and prepares a quick castle.',
    ideas: [
      'Attack the f7 square, defended only by the king.',
      'Develop knights before bishops to the most active squares.',
      'Aim for c3 + d4 to build a strong pawn center.',
    ],
  },
  {
    id: 'ruy-lopez',
    name: 'Ruy L\u00f3pez',
    eco: 'C60',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    description:
      'The "Spanish Game" — a favorite of world champions. White pins the c6 knight and puts long-term pressure on Black\u2019s center instead of attacking immediately.',
    ideas: [
      'Pressure e5 indirectly by pinning the knight on c6.',
      'Play c3 and d4 to consolidate the center.',
      'Takes patience: the advantage grows over many moves.',
    ],
  },
  {
    id: 'sicilian',
    name: 'Sicilian Defense',
    eco: 'B20',
    moves: ['e4', 'c5'],
    description:
      'Black\u2019s most aggressive reply to 1.e4. Instead of mirroring with e5, Black fights for the d4 square from the flank and usually gets an unbalanced, winning-try position.',
    ideas: [
      'Trade a flank pawn (c5) for White\u2019s central pawn later.',
      'Creates imbalanced positions — good if you want to win as Black.',
      'The Open Sicilian (Nf3 + d4) is the main battleground.',
    ],
  },
  {
    id: 'french',
    name: 'French Defense',
    eco: 'C00',
    moves: ['e4', 'e6'],
    description:
      'A solid, resilient defense. Black prepares d5, accepting less space early in return for a rock-solid pawn chain and clear counterplay against White\u2019s center.',
    ideas: [
      'Build a pawn chain e6 + d5 and attack it with ...c5.',
      'The light-squared bishop can be cramped — trade or reroute it.',
      'Counterattack the center rather than defending passively.',
    ],
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    eco: 'B10',
    moves: ['e4', 'c6'],
    description:
      'Like the French but the light-squared bishop stays free. Black supports d5 with c6, trading solidity for a slightly slower development.',
    ideas: [
      'Develop the light-squared bishop outside the pawn chain.',
      'Prepare ...d5 to equalize in the center.',
      'A dependable choice for solid, positional players.',
    ],
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit",
    eco: 'D06',
    moves: ['d4', 'd5', 'c4'],
    description:
      'White offers the c4 pawn to tempt Black into giving up the center. Despite the name, it is not a real gambit — the pawn is quickly recovered.',
    ideas: [
      'Control the center with d4 + c4.',
      'If Black takes on c4, recapture the center with e4.',
      'Develop knights to f3 and c3, then bishops.',
    ],
  },
  {
    id: 'kings-indian',
    name: "King's Indian Defense",
    eco: 'E60',
    moves: ['d4', 'Nf6', 'c4', 'g6'],
    description:
      'A hypermodern defense: Black lets White take the center, then fianchettos the bishop on g7 and strikes back later with ...e5 or ...c5.',
    ideas: [
      'Let White occupy the center, then attack it from the wings.',
      'Fianchetto the king\u2019s bishop to g7.',
      'Look for the ...e5 or ...c5 pawn break.',
    ],
  },
  {
    id: 'london',
    name: 'London System',
    eco: 'D02',
    moves: ['d4', 'd5', 'Bf4'],
    description:
      'A favorite for club players because the setup is the same against almost anything Black plays: d4, Bf4, e3, Nf3, c3, Bd3. Easy to learn, hard to punish.',
    ideas: [
      'Use a fixed setup regardless of Black\u2019s moves.',
      'Develop the dark-squared bishop outside the pawn chain.',
      'Minimize theory: play natural, solid moves.',
    ],
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian Defense',
    eco: 'B01',
    moves: ['e4', 'd5'],
    description:
      'Black immediately challenges the center with d5. After exd5 Qxd5, Black\u2019s queen comes out early — active, but White gains time attacking it.',
    ideas: [
      'Challenge the e4 pawn immediately.',
      'Expect White to gain time against the early queen.',
      'Develop knights and castle quickly after ...Qa5 or ...Qd8.',
    ],
  },
  {
    id: 'pirc',
    name: 'Pirc Defense',
    eco: 'B07',
    moves: ['e4', 'd6'],
    description:
      'Another hypermodern setup. Black delays fighting for the center directly, preparing Nf6 and g6 + Bg7 to strike back later.',
    ideas: [
      'Concede the center now, attack it later.',
      'Fianchetto the bishop to g7.',
      'Flexible move order: ...d6 supports both ...Nf6 and ...g6.',
    ],
  },
  {
    id: 'english',
    name: 'English Opening',
    eco: 'A10',
    moves: ['c4'],
    description:
      'A flank opening where White controls d5 with the c-pawn instead of pushing a central pawn. It often transposes into familiar d4 positions.',
    ideas: [
      'Control the d5 square without committing the center pawns.',
      'Flexible — can transpose into Queen\u2019s Pawn structures.',
      'Good for players who want to avoid heavy opening theory.',
    ],
  },
  {
    id: 'reti',
    name: 'R\u00e9ti Opening',
    eco: 'A04',
    moves: ['Nf3'],
    description:
      'A quiet, hypermodern first move. White develops a knight, keeps the center flexible, and waits to see Black\u2019s plan before committing.',
    ideas: [
      'Develop first, decide on the pawn structure later.',
      'Keep the position flexible and hard to attack.',
      'Often transposes into English or Queen\u2019s Pawn openings.',
    ],
  },
];

// The three core ideas every beginner should internalize before memorizing
// any specific opening moves.
export const PRINCIPLES = [
  {
    title: 'Control the center',
    body:
      'The four central squares — e4, d4, e5, d5 — are the most important. A piece in the center controls more squares and can reach both sides of the board quickly.',
  },
  {
    title: 'Develop your minor pieces early',
    body:
      'Get knights and bishops off the back rank and toward active squares in the first few moves. A common goal is "knights before bishops," but any active development counts.',
  },
  {
    title: 'Castle early',
    body:
      'Your king is vulnerable in the center where files can open. Castling tucks it safely behind pawns and connects your rooks so they can work together.',
  },
  {
    title: 'Don\u2019t move the same piece twice',
    body:
      'Every move you spend repositioning an already-developed piece is a move your opponent uses to develop another piece. Prefer developing a new piece.',
  },
  {
    title: 'Keep the queen safe early',
    body:
      'Bringing the queen out too soon lets the opponent attack it while developing their own pieces. Develop your minor pieces first, then activate the queen.',
  },
  {
    title: 'Connect your rooks',
    body:
      'After castling and developing your minor pieces, your rooks can see each other across the back rank. Connecting them is a good sign your opening is complete.',
  },
  {
    title: 'Know your opening\u2019s plan',
    body:
      'Every opening has a goal — attack f7, pressure e5, fianchetto a bishop, or build a pawn center. Learn the plan, not just the moves, and you\u2019ll know what to do when your opponent deviates.',
  },
  {
    title: 'Don\u2019t make too many pawn moves',
    body:
      'Pawns can\u2019t move backward, so every pawn push creates permanent weaknesses. Push center pawns to claim space, but let your pieces do the fighting.',
  },
];
