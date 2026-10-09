export function formatHumanReadableDuration(totalSeconds: number): string {
  if (typeof totalSeconds !== 'number' || isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  
  if (hours > 0) {
    let result = `${hours} hr`;
    if (minutes > 0) result += ` ${minutes} min`;
    if (seconds > 0) result += ` ${seconds} sec`;
    return result;
  }
  
  if (minutes > 0) {
    let result = `${minutes} min`;
    if (seconds > 0) result += ` ${seconds} sec`;
    return result;
  }
  
  return `${seconds} sec`;
}

export function formatDigitalDuration(totalSeconds: number): string {
  if (typeof totalSeconds !== 'number' || isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
