#!/usr/bin/env python3
import sys

def main():
    """
    Simple energy estimation script for SustainaDev.
    It takes one argument: number of changed lines of code (int),
    and outputs an estimated energy use in kilowatt-hours (kWh).

    The formula is arbitrary for demo purposes:
        energy = lines_changed * 0.00001 kWh
    """
    try:
        lines = int(float(sys.argv[1])) if len(sys.argv) > 1 else 0
    except Exception:
        lines = 0

    # Toy energy model (1e-5 kWh per line)
    kwh = lines * 0.00001

    # Print as a number (stdout only — no extra text!)
    print(f"{kwh:.6f}")

if __name__ == "__main__":
    main()
