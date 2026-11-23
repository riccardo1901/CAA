//! `caa-store`: documenti, biblioteca e sincronizzazione. Scheletro di M0, la logica arriva in M9.

/// Numero di schema del formato `.caa` (cresce a ogni modifica incompatibile).
pub const SCHEMA: u32 = 1;

#[cfg(test)]
mod tests {
    #[test]
    fn schema_parte_da_uno() {
        assert_eq!(super::SCHEMA, 1);
    }
}
