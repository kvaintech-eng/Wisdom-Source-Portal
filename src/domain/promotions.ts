export type PromotionKind = 'normal' | 'repeat' | 'double' | 'special_placement' | 'graduation';

export interface PromotionClass {
  id: string;
  name: string;
  level: string;
  active: boolean;
  next_class_id: string | null;
}

export interface PromotionSuggestion {
  kind: PromotionKind;
  destination_class_id: string;
  reason: string;
}

export function suggestPromotion(
  currentClass: PromotionClass,
  classesById: ReadonlyMap<string, PromotionClass>,
): PromotionSuggestion {
  const nextClass = currentClass.next_class_id
    ? classesById.get(currentClass.next_class_id)
    : undefined;
  if (nextClass?.active) {
    return {
      kind: 'normal',
      destination_class_id: nextClass.id,
      reason: 'End-of-session normal promotion',
    };
  }
  if (currentClass.next_class_id) {
    return {
      kind: 'special_placement',
      destination_class_id: '',
      reason: 'End-of-session placement review',
    };
  }
  if (currentClass.level === 'SS') {
    return {
      kind: 'graduation',
      destination_class_id: '',
      reason: 'End-of-session graduation',
    };
  }
  return {
    kind: 'special_placement',
    destination_class_id: '',
    reason: 'End-of-session placement review',
  };
}
