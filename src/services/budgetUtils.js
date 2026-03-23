import { DURACION_BLOQUE_H } from './constants'

/**
 * Max Lectiva calculation.
 * A 44h contract has a maximum of 38 teaching (lectiva) blocks.
 * Budget for coverages = Max Lectiva - Assigned Classes.
 */
export const getBaseCoverageBudget = (contractHours, assignedClassesCount) => {
  if (!contractHours) return 0
  const maxLectiva = Math.floor((contractHours / 44) * 38)
  return Math.max(0, maxLectiva - assignedClassesCount)
}

export function calculateTeacherUsage(teacherId, schedules, coverages) {
  // Now only coverages count against the budget (which is derived from available slots)
  const coverageUsage = coverages
    .filter(c => c.profesor_reemplazante_id === teacherId && c.estado !== 'cancelada')
    .length

  return coverageUsage
}

export function formatUsage(blocks) {
  return `${blocks} blq`
}
