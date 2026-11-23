//! Mini-lessico scritto a mano, condiviso dai test del motore.

use caa_engine::curated::Curated;
use caa_engine::engine::Engine;
use caa_engine::lexicon::{MorphLexicon, PictoIndex};
use caa_lexicon_build::arasaac;
use caa_lexicon_build::compile::{compile, Inputs};

pub const MORPH: &str = "\
l'\til\tART-M:s
il\til\tART-M:s
la\tla\tART-F:s
la\tla\tPRO-PERS-CLI-3-F-S
la\tla\tNOUN-M:s
albero\talbero\tNOUN-M:s
è\tessere\tVER:ind+pres+3+s
è\tessere\tAUX:ind+pres+3+s
una\tuno\tART-F:s
bella\tbello\tADJ:pos+f+s
giornata\tgiornata\tNOUN-F:s
perché\tperché\tCON
po'\tpo'\tADV
un\tuno\tART-M:s
di\tdi\tPRE
pane\tpane\tNOUN-M:s
porta\tporta\tNOUN-F:s
porta\tportare\tVER:ind+pres+3+s
porta\tportare\tVER:impr+pres+2+s
scuola\tscuola\tNOUN-F:s
rosa\trosa\tNOUN-F:s
mangiare\tmangiare\tVER:inf+pres
occhiali\tocchiale\tNOUN-M:p
maestre\tmaestro\tNOUN-F:p
maestra\tmaestra\tNOUN-F:s
maestro\tmaestro\tNOUN-M:s
tre\ttre\tDET-NUM-CARD
volte\tvolta\tNOUN-F:p
ciao\tciao\tINT
città\tcittà\tNOUN-F:s
più\tpiù\tADV
così\tcosì\tADV
già\tgià\tADV
caffè\tcaffè\tNOUN-M:s
caffè\tcaffè\tNOUN-M:p
";

pub const ARASAAC: &str = r#"[
 {"_id":100,"keywords":[{"type":2,"keyword":"albero"}]},
 {"_id":101,"keywords":[{"type":2,"keyword":"porta"}]},
 {"_id":102,"keywords":[{"type":3,"keyword":"portare"}]},
 {"_id":103,"keywords":[{"type":2,"keyword":"scuola"}]},
 {"_id":104,"keywords":[{"type":2,"keyword":"pane"}]},
 {"_id":116,"keywords":[{"type":2,"keyword":"pane"},{"type":2,"keyword":"panino"},{"type":2,"keyword":"pagnotta"}]},
 {"_id":105,"keywords":[{"type":2,"keyword":"occhiali"}]},
 {"_id":106,"keywords":[{"type":2,"keyword":"maestra"}]},
 {"_id":107,"keywords":[{"type":2,"keyword":"maestro"}]},
 {"_id":108,"keywords":[{"type":2,"keyword":"mandorla","plural":"mandorle"}]},
 {"_id":109,"keywords":[{"type":4,"keyword":"tre"}]},
 {"_id":110,"keywords":[{"type":3,"keyword":"mangiare"}]},
 {"_id":111,"keywords":[{"type":3,"keyword":"essere"}]},
 {"_id":112,"keywords":[{"type":2,"keyword":"giornata"}]},
 {"_id":117,"keywords":[{"type":2,"keyword":"rosa"}]},
 {"_id":118,"keywords":[{"type":5,"keyword":"ciao!"}]},
 {"_id":119,"keywords":[{"type":4,"keyword":"giallo"},{"type":2,"keyword":"giallo"}]},
 {"_id":120,"keywords":[{"type":6,"keyword":"la"}]},
 {"_id":121,"keywords":[{"type":6,"keyword":"in"}]},
 {"_id":122,"keywords":[{"type":6,"keyword":"ci"}]}
]"#;

pub fn engine(lemma_picto: &str, blocklist: &str) -> Engine<Vec<u8>> {
    let pictograms = arasaac::parse(ARASAAC.as_bytes()).unwrap();
    let o = compile(&Inputs {
        build_id: 7,
        morphit: MORPH,
        pictograms: &pictograms,
        forms_extra: &[],
    })
    .unwrap();
    Engine::new(
        MorphLexicon::new(o.morph_fst, o.lemmas_fst, o.morph_feats).unwrap(),
        PictoIndex::new(o.picto_index).unwrap(),
        Curated::parse(lemma_picto, blocklist).unwrap(),
    )
}
