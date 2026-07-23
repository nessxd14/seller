# Transiciones de estado

Las transiciones terminales no permiten cambios posteriores. Los validadores están en `src/domain/common/stateMachine.ts`.

## Cotización

```text
draft → sent | rejected
sent → negotiating | approved | rejected | expired
negotiating → sent | approved | rejected | expired
approved → converted | expired
rejected | expired | converted → terminal
```

## Pedido

```text
draft → confirmed | cancelled
confirmed → awaiting_stock | reserved | cancelled
awaiting_stock → reserved | cancelled
reserved → preparing | cancelled
preparing → ready | cancelled
ready → dispatched | delivered | cancelled
dispatched → delivered
delivered | cancelled → terminal
```

## Venta

```text
pending_payment → partially_paid | paid | cancelled
partially_paid → paid | cancelled
paid → partially_returned | returned
partially_returned → returned
cancelled | returned → terminal
```

## Transferencia

```text
requested → approved | cancelled
approved → preparing | cancelled
preparing → in_transit | cancelled
in_transit → received
received | cancelled → terminal
```

