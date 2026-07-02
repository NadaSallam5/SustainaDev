def find_duplicates(nums):
    seen = set()
    duplicates = []

    for num in nums:
        if num in seen and num not in duplicates:
            duplicates.append(num)
        seen.add(num)

    return duplicates