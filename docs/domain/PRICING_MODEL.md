# Modelo de precios

`PriceList` pertenece a un canal y tiene vigencia. `ProductPrice` define el precio por producto/presentación y cantidad mínima. `CustomerSpecialPrice` puede sustituir el precio de lista dentro de su vigencia.

Orden de resolución inicial:

1. Lista activa del canal y fecha.
2. Tramo por cantidad más específico.
3. Precio especial vigente del cliente, si existe.
4. Descuento simple aplicable.
5. Precio sugerido.

Un override manual es posterior a la resolución y requiere auditoría. El snapshot guarda lista, precio base, especial, descuento y precio aplicado. Promociones combinables y reglas de autorización quedan fuera de 2A.

