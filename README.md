# n8n-nodes-geloky

This is an n8n community node. It lets you use [Geloky](https://geloky.com) in your n8n workflows.

Geloky is a geocoding and distance service. It turns addresses into latitude and longitude, coordinates into
addresses, and measures road distance and travel time, paid per lookup from a prepaid API wallet.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation
platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community
nodes documentation. The package name is `n8n-nodes-geloky`.

## Operations

| Operation | What you give it | What you get | Cost |
| --- | --- | --- | --- |
| Geocode Address | An address, a place or a postal code | `latitude`, `longitude`, `coordinates`, `matched_address`, `map_url` | $0.001, found or not |
| Reverse Geocode | Latitude and longitude, in decimal degrees | `address`, `type` (address, place, street or area), `distance_m`, `address_latitude`, `address_longitude`, `plus_code`, `map_url` | $0.001, found or not |
| Calculate Distance | From and To: each an address, or a latitude and longitude such as `40.74838,-73.98485` | `distance`, `distance_units`, `travel_time_minutes`, `straight_line`, both ends' coordinates and matched addresses | $0.001, plus $0.001 for each end given as an address |

Calculate Distance has options for the vehicle (car, truck or walking), the units (miles or kilometers) and the route
(fastest or shortest). With no road between the two ends, the distance is a straight line, `straight_line` is
`true`, and there is no travel time.

Every result has `found` and `cost_usd`:

- `found: false` means nothing matched, or the input was empty or not a valid point. A `message` says which. The
  workflow goes on with the next item, so one bad row doesn't stop a list.
- Empty or invalid inputs are never sent to Geloky, so they cost nothing. An address that Calculate Distance can't
  find costs nothing either.
- A wrong API key or an empty wallet stops the node with an error, because you need to fix it. Turn on the node's
  **On Error → Continue** setting if you'd rather get an `error` field on each item instead.

The node can also be used as a tool by n8n's AI Agent.

## Credentials

You need a Geloky account and its API key:

1. Sign up at [geloky.com](https://geloky.com/sign-up).
2. Open the [API tab of your dashboard](https://geloky.com/dashboard/tab/api) and copy your key.
3. Top up your API wallet on the same tab. Lookups are paid from it at $0.001 each.
4. In n8n, create a **Geloky API** credential and paste the key.

n8n checks the key when you save the credential. The check is free and passes with an empty wallet too, so you can
connect first and top up later. Pressing **Change** on the API tab replaces your key; then paste the new one into the
credential.

## Compatibility

Built with `@n8n/node-cli` 0.57 and tested with n8n 2.48.6.

## Usage

A common workflow adds coordinates to a spreadsheet:

1. **Google Sheets: Get Rows** reads the addresses.
2. **Geloky: Geocode Address**, with **Address** set to an expression such as `{{ $json.Address }}`.
3. **Google Sheets: Update Row** writes `latitude` and `longitude` back to each row. Use the row number from the
   first step, for example `{{ $('Get Rows').item.json.row_number }}`.

Items are looked up one after another, about four a second. To geocode a whole spreadsheet at once, you can also
upload it to [Geloky's batch geocoding](https://geloky.com/geocoding/).

`map_url` opens the point on Geloky's map, with the same point in other formats.

<details>
<summary>An example workflow to paste into n8n</summary>

Copy this and paste it into an empty workflow, then pick your Geloky credential on both Geloky nodes.

```json
{
  "nodes": [
    { "parameters": {}, "name": "Start", "type": "n8n-nodes-base.manualTrigger", "typeVersion": 1, "position": [0, 0] },
    {
      "parameters": { "operation": "geocode", "address": "350 5th Ave, New York, NY 10118" },
      "name": "Geocode address", "type": "n8n-nodes-geloky.geloky", "typeVersion": 1, "position": [220, 0]
    },
    {
      "parameters": {
        "operation": "calculateDistance",
        "origin": "={{ $json.coordinates }}",
        "destination": "1 Liberty Plaza, New York, NY",
        "options": { "units": "km" }
      },
      "name": "Calculate distance", "type": "n8n-nodes-geloky.geloky", "typeVersion": 1, "position": [440, 0]
    }
  ],
  "connections": {
    "Start": { "main": [[{ "node": "Geocode address", "type": "main", "index": 0 }]] },
    "Geocode address": { "main": [[{ "node": "Calculate distance", "type": "main", "index": 0 }]] }
  }
}
```

</details>

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Geloky API documentation](https://geloky.com/help-api)
- [Geloky pricing](https://geloky.com/price-api)

## Version history

- 0.1.0: Geocode Address, Reverse Geocode and Calculate Distance.
