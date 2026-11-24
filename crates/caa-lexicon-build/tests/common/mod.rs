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
labbro\tlabbro\tNOUN-M:s
labbra\tlabbro\tNOUN-F:p
pasto\tpasto\tNOUN-M:s
pasta\tpasta\tNOUN-F:s
pastello\tpastello\tNOUN-M:s
pastelli\tpastello\tNOUN-M:p
uomo\tuomo\tNOUN-M:s
uomini\tuomo\tNOUN-M:p
città\tcittà\tNOUN-F:s
più\tpiù\tADV
così\tcosì\tADV
già\tgià\tADV
caffè\tcaffè\tNOUN-M:s
caffè\tcaffè\tNOUN-M:p
lavare\tlavare\tVER:inf+pres
dicendo\tdire\tVER:ger+pres
prendi\tprendere\tVER:impr+pres+2+s
giova\tgiovare\tVER:impr+pres+2+s
giovane\tgiovane\tADJ:pos+m+s
ho\tavere\tAUX:ind+pres+1+s
mangiato\tmangiare\tVER:part+past+s+m
era\tessere\tAUX:ind+impf+3+s
sono\tessere\tAUX:ind+pres+1+s
sto\tstare\tVER:ind+pres+1+s
stava\tstare\tVER:ind+impf+3+s
dormendo\tdormire\tVER:ger+pres
mi\tmi\tPRO-PERS-CLI-1-M-S
lavato\tlavare\tVER:part+past+s+m
lavo\tlavare\tVER:ind+pres+1+s
mangerò\tmangiare\tVER:ind+fut+1+s
andato\tandare\tVER:part+past+s+m
sono\tessere\tAUX:ind+pres+3+p
sono\tessere\tVER:ind+pres+3+p
utile\tutile\tADJ:pos+m+s
stato\tessere\tVER:part+past+s+m
ci\tci\tPRO-PERS-CLI-1-M-P
si\tsi\tSI
divertito\tdivertire\tVER:part+past+s+m
divertito\tdivertito\tADJ:pos+m+s
essere\tessere\tAUX:inf+pres
mette\tmettere\tVER:ind+pres+3+s
mettere\tmettere\tVER:inf+pres
scarpe\tscarpa\tNOUN-F:p
scarpa\tscarpa\tNOUN-F:s
andiamo\tandare\tVER:ind+pres+1+p
siamo\tessere\tAUX:ind+pres+1+p
che\tche\tWH-CHE
lava\tlavare\tVER:impr+pres+2+s
voglio\tvolere\tVER:ind+pres+1+s
vuole\tvolere\tVER:ind+pres+3+s
le\tla\tART-F:p
mele\tmela\tNOUN-F:p
nella\tnella\tARTPRE-F:s
nelle\tnella\tARTPRE-F:p
al\tal\tARTPRE-M:s
ferro\tferro\tNOUN-M:s
ferri\tferro\tNOUN-M:p
stiro\tstiro\tNOUN-M:s
da\tda\tPRE
colazione\tcolazione\tNOUN-F:s
fatto\tfare\tVER:part+past+s+m
fare\tfare\tVER:inf+pres
far\tfare\tVER:inf+pres
hanno\tavere\tAUX:ind+pres+3+p
i\til\tART-M:p
denti\tdente\tNOUN-M:p
dente\tdente\tNOUN-M:s
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
 {"_id":122,"keywords":[{"type":6,"keyword":"ci"}]},
 {"_id":123,"keywords":[{"type":2,"keyword":"labbra"}]},
 {"_id":124,"keywords":[{"type":2,"keyword":"pasta"}]},
 {"_id":125,"keywords":[{"type":2,"keyword":"pastelli"}]},
 {"_id":126,"keywords":[{"type":2,"keyword":"uomini"}]},
 {"_id":127,"keywords":[{"type":3,"keyword":"lavarsi"}]},
 {"_id":128,"keywords":[{"type":3,"keyword":"lavare"}]},
 {"_id":129,"keywords":[{"type":3,"keyword":"dormire"}]},
 {"_id":130,"keywords":[{"type":3,"keyword":"andare"}]},
 {"_id":131,"keywords":[{"type":2,"keyword":"ferro da stiro","plural":"ferri da stiro"}]},
 {"_id":132,"keywords":[{"type":3,"keyword":"far colazione"}]},
 {"_id":133,"keywords":[{"type":3,"keyword":"lavarsi i denti"}]},
 {"_id":134,"keywords":[{"type":2,"keyword":"dente"}]},
 {"_id":135,"keywords":[{"type":5,"keyword":"le tre"}]},
 {"_id":136,"keywords":[{"type":3,"keyword":"esserci"}]},
 {"_id":137,"keywords":[{"type":3,"keyword":"mettere le scarpe"}]},
 {"_id":138,"keywords":[{"type":6,"keyword":"che"}]}
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

/// Come `engine`, con l'indice delle multiparola costruito dalle parole chiave del mini-lessico.
#[allow(dead_code)] // la usa solo mwe_mini
pub fn engine_mwe(lemma_picto: &str, blocklist: &str) -> Engine<Vec<u8>> {
    use caa_lexicon_build::mwe_build::build_mwe;
    let pictograms = arasaac::parse(ARASAAC.as_bytes()).unwrap();
    let plain = engine(lemma_picto, blocklist);
    let built = build_mwe(&plain, &arasaac::index_entries(&pictograms), 7).unwrap();
    plain.with_mwe(caa_engine::mwe::MweIndex::new(built.bytes).unwrap())
}

/// Come `engine`, con i prior curati di `ambiguity_priors.tsv`.
#[allow(dead_code)] // la usa solo tagger_mini
pub fn engine_priors(priors: &str) -> Engine<Vec<u8>> {
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
        Curated::parse("", "").unwrap().with_priors(priors).unwrap(),
    )
}
