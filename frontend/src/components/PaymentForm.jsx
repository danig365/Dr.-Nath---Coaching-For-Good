import { useState } from "react";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { toast } from "react-toastify";
import { api } from "../utils/auth";

export default function PaymentForm({ clientSecret, amount, bookingData, onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handlePay = async () => {
    if (!stripe || !elements) return;
    setProcessing(true);

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: elements.getElement(CardElement) }
    });

    if (error) {
      toast.error(error.message);
      setProcessing(false);
      return;
    }

    if (paymentIntent.status === 'succeeded') {
      try {
        await api.post('/bookings/confirm-payment/', {
          payment_intent_id: paymentIntent.id,
          booking_data: bookingData,
        });
        toast.success("Payment successful! Booking request sent.");
        onSuccess();
      } catch (err) {
        toast.error("Payment succeeded but booking failed. Contact support.");
      }
    }
    setProcessing(false);
  };

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl p-4 bg-white transition-all duration-200"
        style={{ border: "1px solid rgba(200,169,81,0.3)" }}
      >
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#1B2B4A",
                fontFamily: "Inter, sans-serif",
                "::placeholder": { color: "#7A8699" },
              },
              invalid: { color: "#B91C1C" },
            },
          }}
        />
      </div>

      <div className="flex justify-between items-center text-sm">
        <span style={{ color: "#4A5568" }}>Total</span>
        <span className="font-bold text-base" style={{ color: "#A9863A", fontFamily: "'Playfair Display', serif" }}>
          ${amount?.toFixed(2)}
        </span>
      </div>

      <button
        onClick={handlePay}
        disabled={processing || !stripe}
        className="w-full gold-btn py-3.5 rounded-full text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {processing ? (
          <>
            <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "#14213D", borderTopColor: "transparent" }} />
            Processing...
          </>
        ) : (
          `Pay $${amount?.toFixed(2)}`
        )}
      </button>
    </div>
  );
}