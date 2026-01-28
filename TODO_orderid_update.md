# TODO: Add dynamic orderid to payment redirect URL

## Task Summary

Add a dynamically generated `orderid` parameter to the payment redirect URL in cart-client.js

## Steps to Complete:

- [x] 1. Generate a unique order ID BEFORE posting order request
- [x] 2. Include order_id in the POST request to backend
- [x] 3. Store orderid in sessionStorage for persistence
- [x] 4. Use the same order_id in payment redirect URL
- [ ] 5. Test the implementation (Manual testing required)

## Implementation Details

File to modify: `websites/snack/includes/cart-client.js`

The payment redirect URL should become:

```
https://payments.appsthink.com/initiate-payment?amount=X&source=spicykik&email=...&phone=...&name=...&orderid=ORDER123
```

Where ORDER123 is a dynamically generated unique order ID.
