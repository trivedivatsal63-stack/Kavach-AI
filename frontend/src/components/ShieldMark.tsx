export function ShieldMark({
  className = "h-8 w-auto",
}: {
  className?: string;
}) {
  return (
    <img
      src="/harrier-logo.png"
      alt="Harrier"
      className={className}
    />
  );
}
