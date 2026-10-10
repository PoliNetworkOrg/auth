import { Fragment } from "react";

/**
 * An address that wraps where people expect: before the @, then after the dots in the name.
 * Without these break points a narrow card splits it mid-word ("polinetw" / "ork.org").
 */
export function Email({ address }: { address: string }) {
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  const name = address.slice(0, at).split(/(?<=\.)/);
  return (
    <>
      {name.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
      <wbr />
      {address.slice(at)}
    </>
  );
}
