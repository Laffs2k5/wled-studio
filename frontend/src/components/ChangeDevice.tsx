// SPDX-License-Identifier: EUPL-1.2
import { focusDeviceSelect } from "../devices";

/** Next to a heading that names the header's device: takes you to the header's device select. */
export function ChangeDevice() {
  return (
    <button type="button" className="link small change-device" title="Every view works on the device chosen in the header"
      onClick={focusDeviceSelect}>Change device</button>
  );
}
