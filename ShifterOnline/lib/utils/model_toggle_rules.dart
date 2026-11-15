/// Linked ON/OFF rules for the delivery-model toggles (Model 1 on top ... last model at the bottom).
///
/// Whatever the number of models, the ON models are always an unbroken run from the top: [lowestOnIndex] is the
/// index of the lowest model that is ON (0 = the top model), or null when every model is OFF. Nothing here knows
/// how many models exist or what they are called.
///
///  * Turning a model ON turns ON every model above it; the models below it keep their state.
///  * Turning a model OFF turns it and every model below it OFF; the models above it stay ON.
library;

/// Whether the model at [index] is ON.
bool isModelOn(int? lowestOnIndex, int index) => lowestOnIndex != null && index <= lowestOnIndex;

/// The new lowest-ON index after the model at [index] is switched [on] / off, or null when all are OFF.
/// [count] is the number of models; an [index] outside 0..count-1 changes nothing.
int? applyModelToggle({required int? lowestOnIndex, required int index, required bool on, required int count}) {
  if (index < 0 || index >= count) return lowestOnIndex;
  if (on) {
    // everything above [index] comes ON with it; models below keep their state (a lower ON model stays ON)
    return lowestOnIndex == null || index > lowestOnIndex ? index : lowestOnIndex;
  }
  // [index] and everything below it goes OFF; what is above stays as it was
  final highestKept = index - 1;
  if (lowestOnIndex == null) return null;
  final next = lowestOnIndex < highestKept ? lowestOnIndex : highestKept;
  return next < 0 ? null : next;
}
